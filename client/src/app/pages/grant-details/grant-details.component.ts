import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { GrantService } from 'src/app/services/grant.service';
import { ToastrService } from 'ngx-toastr';
import * as moment from 'moment';
import Swal from 'sweetalert2';
import { EthcontractService } from 'src/app/services/ethcontract.service';
import { AppSettings } from 'src/app/config/app.config';
import { HTTPRESPONSE } from 'src/app/common/http-helper/http-helper.class';
import { PayoutService } from 'src/app/services/payout.service';
import { ethers, providers, utils } from 'ethers';
import { SubgraphService } from 'src/app/services/subgraph.service';
import { Events, ModalController } from '@ionic/angular';
import { AuthService } from 'src/app/services/auth.service';
import { ThreeBoxService } from 'src/app/services/threeBox.service';
import { PayoutComponent } from '../payout/payout.component'

declare let window: any;

@Component({
  selector: 'app-grant-details',
  templateUrl: './grant-details.component.html',
  styleUrls: ['./grant-details.component.scss'],
})
export class GrantDetailsComponent implements OnInit {
  toastTitle = "Grant"
  isLogin = AuthService.isAuthenticated();
  contractAddress = "";

  userEnum = {
    VISITOR: "visitor",
    MANAGER: "manager",
    GRANTEE: "grantee",
    DONOR: "donor",
  }

  grant: any;
  manager3boxProfile: any;
  userType = this.userEnum.VISITOR;
  noOfDonors = 0;
  userDonation = 0;
  noOfDayToExpiredFunding = 0;
  canCancel = false;

  payouts = [];
  pendingRequest = [];
  approveRequest = [];
  rejectRequest = []
  myFunds = [];
  totalFundByMe = 0;
  totalPending = 0;
  totalApproved = 0;
  totalReject = 0;
  multipleMilestones = false;
  processing = false;
  submitted = false;
  user: any;
  canFund: any = false;
  canRequestPayout = false;
  balance: any = 0;
  remainingAlloc: any = 0;

  grantFund = {
    contractAddress: '',
    amount: null
  }

  constructor(
    private route: ActivatedRoute,
    private grantService: GrantService,
    public modalController: ModalController,
    private payoutService: PayoutService,
    private toastr: ToastrService,
    public events: Events,
    private subgraphService: SubgraphService,
    private authService: AuthService,
    private ethcontractService: EthcontractService,
    private threeBoxService: ThreeBoxService
  ) {
    this.contractAddress = this.route.snapshot.params.id || '';
    this.grantFund.contractAddress = this.contractAddress;

    (async () => {
      try {
        this.user = JSON.parse(localStorage.getItem(AppSettings.localStorage_keys.userData));

        let res = await this.grantService.getByContract(this.contractAddress).toPromise();
        this.grant = res.data;
        this.grant.content = this.htmlDecode(this.grant.content);
        this.checkRoll();
        this.getContractData();
        this.manager3boxProfile = await this.threeBoxService.getProfile(this.grant.manager.toLowerCase());
        console.log("manager3boxProfile", this.manager3boxProfile);
      } catch (e) { }
    })();
  }

  ngOnInit() {
    this.events.subscribe('is_logged_in', (data) => {
      this.isLogin = data;
      setTimeout(() => {
        this.checkRoll();
      }, 100);
    });
  }

  async payoutModel(data: any) {
    const modal = await this.modalController.create({
      component: PayoutComponent,
      cssClass: 'custom-modal-style',
      mode: "ios",
      componentProps: {
        grantData: this.grant
      }
    });

    modal.onDidDismiss()
      .then((data) => {
        const reload = data['data'];
      });

    return await modal.present();
  }

  htmlDecode(input: any) {
    var e = document.createElement("textarea");
    e.innerHTML = input;
    return e.value;
  };

  checkRoll() {
    this.user = JSON.parse(localStorage.getItem(AppSettings.localStorage_keys.userData));

    if (this.isLogin && this.user && this.user.hasOwnProperty('publicAddress') && this.user.publicAddress) {
      this.userType = this.userEnum.DONOR;

      if (this.grant.manager.toLowerCase() == this.user.publicAddress.toLowerCase()) {
        this.userType = this.userEnum.MANAGER;
      }

      this.grant.grantees.map((data) => {
        if (data.grantee.toLowerCase() == this.user.publicAddress.toLowerCase()) {
          this.userType = this.userEnum.GRANTEE;
        }
      });

      if (this.userType == this.userEnum.MANAGER) {
        this.getManagerData();
      }

      if (this.userType == this.userEnum.GRANTEE) {
        this.getGranteeData();
      }

      if (this.userType == this.userEnum.DONOR) {
        this.getDonorData();
      }

      this.canCancelGrant();
    }
  }

  async getContractData() { 
    if (this.grant.type == "singleDeliveryDate") {
      this.noOfDayToExpiredFunding = moment(this.grant.singleDeliveryDate.fundingExpiryDate).diff(moment(new Date), 'days')
    } else {
      this.noOfDayToExpiredFunding = moment(this.grant.multipleMilestones[this.grant.multipleMilestones.length - 1].completionDate).diff(moment(new Date), 'days')
    }
    
    this.subgraphService.getFundByContract(this.contractAddress).subscribe((res: any) => {
      this.noOfDonors = res.data.funds.length;
    })

    let promise = [];
    promise.push(
      this.ethcontractService.checkAvailableBalance(this.contractAddress),
      this.ethcontractService.canFund(this.contractAddress),
    );

    let promiseRes = await Promise.all(promise);
    this.balance = promiseRes[0];
    this.canFund = promiseRes[1];

    console.log("this.balance", this.balance);
    console.log("this.userType", this.userType);
    if (this.canFund) {
      if (this.userType == this.userEnum.MANAGER || this.userType == this.userEnum.GRANTEE) {
        this.canFund = false;
      }
    } else {
      if (this.userType == this.userEnum.GRANTEE) {
        this.canRequestPayout = true;
      }
    }
  }

  getManagerData() {
    this.payoutService.getByGrant(this.grant._id).subscribe((res: HTTPRESPONSE) => {
      this.payouts = res.data;
      this.pendingRequest = [];
      this.approveRequest = [];
      this.rejectRequest = [];
      this.totalPending = 0;
      this.totalApproved = 0;
      this.totalReject = 0;
      this.payouts.map((data) => {
        if (data.requestStatus == "pending") {
          this.pendingRequest.push(data);
          this.totalPending += data.requestAmount;
        }
        if (data.requestStatus == "approved") {
          this.approveRequest.push(data);
          this.totalApproved += data.requestAmount;
        }
        if (data.requestStatus == "rejected") {
          this.rejectRequest.push(data);
          this.totalReject += data.requestAmount;
        }
      });
    })
  }

  getGranteeData() {
    this.remainingAlloc = this.ethcontractService.remainingAllocation(this.grant.contractAddress, this.user.publicAddress);
    this.subgraphService.getPaymentByContractAndDonor(this.contractAddress, this.user.publicAddress).subscribe((res: any) => {
      this.payouts = res.data.payments;
      this.payouts = this.payouts.map((task) => {
        if (this.grant.currency == "ETH") {
          task.amount = ethers.utils.formatEther(task.amount);
          this.totalFundByMe += +task.amount;
        } else {
          this.totalFundByMe += +task.amount;
        }
        return task;
      });
    })
  }

  getDonorData() {
    this.subgraphService.getFundByContractAndDonor(this.contractAddress, this.user.publicAddress).subscribe((res: any) => {
      this.myFunds = res.data.funds;
      this.myFunds = this.myFunds.map((task) => {
        if (this.grant.currency == "ETH") {
          task.amount = ethers.utils.formatEther(task.amount);
          this.userDonation += +task.amount;
        } else {
          this.userDonation += +task.amount;
        }
        return task;
      });
    })
  }

  canCancelGrant() {
    if (this.grant.manager._id != this.user._id) {
      if (this.grant.type == "multipleMilestones") {
        let date = moment(this.grant.multipleMilestones[this.grant.multipleMilestones.length - 1].completionDate, 'DD/MM/YYYY').toISOString();
        let isAfter = moment(date).isAfter(moment(new Date().toISOString()));
        if (!isAfter) {
          this.canCancel = true;
        }
      } else {
        let date = moment(this.grant.singleDeliveryDate.completionDate, 'DD/MM/YYYY').toISOString();
        let isAfter = moment(date).isAfter(moment(new Date().toISOString()));
        if (!isAfter) {
          this.canCancel = true;
        }
      }
    }
  }

  ConfirmCancleGrant() {
    Swal.fire({
      title: 'Are you sure?',
      text: "You won't be able to revert this!",
      icon: 'warning',
      backdrop: false,
      allowOutsideClick: false,
      showCancelButton: true,
      confirmButtonText: 'Yes',
      cancelButtonText: 'No',
      reverseButtons: true
    }).then(async (result) => {
      if (result.value) {
        this.cancelGrant();
        // Swal.fire('Deleted!', 'Your request has been sent', 'success');
      } else if (
        result.dismiss === Swal.DismissReason.cancel
      ) {
        // Swal.fire('Cancelled', 'Your request cancelled :)', 'error');
      }
    })
  }

  async cancelGrant() {
    try {
      let cancelGrant: any = await this.ethcontractService.cancelGrant(this.grant.contractAddress);
      if (cancelGrant.status == "success") {
        this.toastr.success('Send Request to cancele grant');
      } else {
        this.toastr.error(cancelGrant.message);
      }
    } catch (e) {
      this.toastr.error('Something went wrong !!', this.toastTitle);
    }
  }

  ConfirmFundGrant() {
    if (this.isLogin) {
      Swal.fire({
        title: 'Are you sure?',
        text: "You won't be able to revert this!",
        icon: 'warning',
        backdrop: false,
        allowOutsideClick: false,
        showCancelButton: true,
        confirmButtonText: 'Yes',
        cancelButtonText: 'No',
        reverseButtons: true
      }).then(async (result) => {
        if (result.value) {
          this.fundOnGrant();
        } else if (
          result.dismiss === Swal.DismissReason.cancel
        ) {
        }
      })
    } else {
      this.toastr.warning("Please login the App", this.toastTitle);
    }
  }

  async fundOnGrant() {
    try {
      if (this.grant.currency == "ETH") {
        this.grantFund.amount = (ethers.utils.parseEther(this.grantFund.amount.toString())).toString();
      }
      let funding: any = await this.ethcontractService.fund(this.grant.contractAddress, this.grantFund.amount);
      this.grantFund.amount = null;
      if (funding.status == "success") {
        this.toastr.success('Send Fund to grant');
      } else {
        this.toastr.error(funding.message);
      }

    } catch (e) {
      this.processing = false;
      this.toastr.error('Something went wrong !!', this.toastTitle);
    }
  }

  confiremApproveRefund(request, index) {
    Swal.fire({
      title: 'Are you sure?',
      text: "You won't be able to revert this!",
      icon: 'warning',
      backdrop: false,
      allowOutsideClick: false,
      showCancelButton: true,
      confirmButtonText: 'Yes',
      cancelButtonText: 'No',
      reverseButtons: true
    }).then(async (result) => {
      if (result.value) {
        this.approveRefundRequest(request, index);
        // Swal.fire('Deleted!', 'Your request has been sent', 'success');
      } else if (
        result.dismiss === Swal.DismissReason.cancel
      ) {
        // Swal.fire('Cancelled', 'Your request cancelled :)', 'error');
      }
    })
  }

  async approveRefundRequest(request, index) {
    try {
      let approveRefund: any = await this.ethcontractService.approveRefund("0x2401624A0CbcB22e54433F3d0E672607Ee911e85", "0xb7c1A4eB0f206D38C4Db9798098F5aa6683BCBd8", 20);
      console.log("approveRefund", approveRefund);
      if (approveRefund.status == "Success") {
        console.log("call")
        this.payoutService.approve(request._id).subscribe((res: HTTPRESPONSE) => {
          this.toastr.success(res.message, this.toastTitle);
          this.getManagerData();
        }, (err) => {
          this.processing = false;
          this.toastr.error(err.error.message, this.toastTitle);
        })
      }
    } catch (e) {
      this.processing = false;
      this.submitted = false;
      this.toastr.error('Something went wrong !!', this.toastTitle);
    }
  }

  confiremWithdrawRefund() {
    Swal.fire({
      title: 'Are you sure?',
      text: "You won't be able to revert this!",
      icon: 'warning',
      backdrop: false,
      allowOutsideClick: false,
      showCancelButton: true,
      confirmButtonText: 'Yes',
      cancelButtonText: 'No',
      reverseButtons: true
    }).then(async (result) => {
      if (result.value) {
        this.withdrawRefund();
        // Swal.fire('Deleted!', 'Your request has been sent', 'success');
      } else if (
        result.dismiss === Swal.DismissReason.cancel
      ) {
        // Swal.fire('Cancelled', 'Your request cancelled :)', 'error');
      }
    })
  }

  async withdrawRefund() {
    let refund: any = await this.ethcontractService.withdrawRefund("0x2401624A0CbcB22e54433F3d0E672607Ee911e85", "0x14791697260E4c9A71f18484C9f997B308e59325");
    // console.log("refund", refund);
  }

  async signal() {
    let signal: any = await this.ethcontractService.signal("0x9b145f6e929012CbAcbd9b1E9B008E3a151684A0", true, this.grant.amount);

  }
}