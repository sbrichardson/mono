const {chai, expect, decimals, BN, bigVal, mochaEach, getBalance } = require('./testHelpers.js');
const { time } = require('@openzeppelin/test-helpers');
let accounts;
let owner
let person2
let person3;
const CreditDesk = artifacts.require('TestCreditDesk');
const CreditLine = artifacts.require('CreditLine');
const Pool = artifacts.require('TestPool');
let creditDesk;

describe("CreditDesk", () => {
  let underwriterLimit;
  let underwriter;
  let borrower;
  let limit = bigVal(500);
  let interestApr = bigVal(5).div(new BN(100));
  let minCollateralPercent = bigVal(10);
  let paymentPeriodInDays = new BN(30);
  let termInDays = new BN(365);

  let createCreditLine = async ({_borrower, _limit, _interestApr, _minCollateralPercent, _paymentPeriodInDays,_termInDays} = {}) => {
    _borrower = _borrower || person3;
    _limit = _limit || limit;
    _interestApr = _interestApr || interestApr;
    _minCollateralPercent = _minCollateralPercent || minCollateralPercent;
    _paymentPeriodInDays = _paymentPeriodInDays || paymentPeriodInDays;
    _termInDays = _termInDays || termInDays;
    await creditDesk.createCreditLine(_borrower, _limit, _interestApr, _minCollateralPercent, _paymentPeriodInDays,_termInDays, {from: underwriter});
  }

  beforeEach(async () => {
    accounts = await web3.eth.getAccounts();
    [ owner, person2, person3 ] = accounts;
    creditDesk = await CreditDesk.new({from: owner});
    pool = await Pool.new({from: owner});
    await pool.transferOwnership(creditDesk.address, {from: owner});
    await pool.deposit({from: person2, value: String(bigVal(90))})
    await creditDesk.setPoolAddress(pool.address, {from: owner});
  })

  it('deployer is owner', async () => {
    expect(await creditDesk.owner()).to.equal(owner);
  });

  describe('setUnderwriterGovernanceLimit', () => {
    it('sets the correct limit', async () => {
      const amount = bigVal(537);
      await creditDesk.setUnderwriterGovernanceLimit(person2, amount, {from: owner});
      const underwriterLimit = await creditDesk.underwriters(person2);
      expect(underwriterLimit.eq(amount)).to.be.true;
    });
  });

  describe('createCreditLine', () => {
    let underwriterLimit;
    let underwriter;
    let borrower;
    let limit = new BN(500);
    let interestApr = new BN(5);
    let minCollateralPercent = new BN(10);
    let paymentPeriodInDays = new BN(30);
    let termInDays = new BN(365);

    let createCreditLine = async ({_borrower, _limit, _interestApr, _minCollateralPercent, _paymentPeriodInDays,_termInDays} = {}) => {
      _borrower = _borrower || person3;
      _limit = _limit || limit;
      _interestApr = _interestApr || interestApr;
      _minCollateralPercent = _minCollateralPercent || minCollateralPercent;
      _paymentPeriodInDays = _paymentPeriodInDays || paymentPeriodInDays;
      _termInDays = _termInDays || termInDays;
      await creditDesk.createCreditLine(_borrower, _limit, _interestApr, _minCollateralPercent, _paymentPeriodInDays, _termInDays, {from: underwriter});
    }
    beforeEach(async () => {
      underwriter = person2;
      borrower = person3;
      underwriterLimit = bigVal(600);
      await creditDesk.setUnderwriterGovernanceLimit(underwriter, underwriterLimit, {from: owner});
    })

    it('sets the CreditDesk as the owner', async () => {
      await createCreditLine();
      var ulCreditLines = await creditDesk.getUnderwriterCreditLines(underwriter);
      const creditLine = await CreditLine.at(ulCreditLines[0]);

      expect(await creditLine.owner()).to.equal(creditDesk.address);
    });

    it('should create and save a creditline', async () => {
      await createCreditLine({});

      var ulCreditLines = await creditDesk.getUnderwriterCreditLines(underwriter);
      const creditLine = await CreditLine.at(ulCreditLines[0]);

      expect(ulCreditLines.length).to.equal(1);
      expect(await creditLine.borrower()).to.equal(borrower);
      expect((await creditLine.limit()).eq(limit)).to.be.true;
      expect((await creditLine.interestApr()).eq(interestApr)).to.be.true;
      expect((await creditLine.minCollateralPercent()).eq(minCollateralPercent)).to.be.true;
      expect((await creditLine.paymentPeriodInDays()).eq(paymentPeriodInDays)).to.be.true;
      expect((await creditLine.termInDays()).eq(termInDays)).to.be.true;
    });

    it("should not let you create a credit line above your limit", async () => {
      const expectedErr = "The underwriter cannot create this credit line";
      try {
        await createCreditLine({_limit: bigVal(601)});
        throw("This test should have failed earlier");
      } catch(e) {
        expect(e.message).to.include(expectedErr);
      }
    });

    it("should not let you create a credit line above your limit, if the sum of your existing credit lines puts you over the limit", async () => {
      await createCreditLine({_limit: bigVal(300)})
      await createCreditLine({_limit: bigVal(300)})

      const expectedErr = "The underwriter cannot create this credit line";
      try {
        await createCreditLine({_limit: bigVal(1)});
        throw("This test should have failed earlier");
      } catch(e) {
        expect(e.message).to.include(expectedErr);
      }
    });

    describe("Creating the credit line with invalid data", async () => {
      // TOOD: Write more of these validations.
      it.skip("should enforce the limit is above zero", async () => {

      });
    });
  });

  describe('drawdown', async () => {
    let drawdown = async (amount, creditLineAddress) => {
      return await creditDesk.drawdown(amount, creditLineAddress, {from: borrower});
    }
    let creditLine;
    let blocksPerDay = 60 * 60 * 24 / 15;

    beforeEach(async () => {
      underwriter = person2;
      borrower = person3;
      underwriterLimit = bigVal(600);
      await creditDesk.setUnderwriterGovernanceLimit(underwriter, underwriterLimit, {from: owner});

      await createCreditLine();
      var ulCreditLines = await creditDesk.getUnderwriterCreditLines(underwriter);
      creditLine = await CreditLine.at(ulCreditLines[0]);
    });

    it('should set the termEndAt correctly', async () => {
      expect((await creditLine.termEndBlock()).eq(new BN(0))).to.be.true;

      await drawdown(bigVal(10), creditLine.address);
      currentBlock = await time.latestBlock();
      const blockLength = new BN(termInDays).mul(new BN(blocksPerDay));

      const expectedTermEndBlock = currentBlock.add(blockLength);
      expect((await creditLine.termEndBlock()).eq(expectedTermEndBlock)).to.be.true;
    });
  });

  describe("calculateAnnuityPayment", async () => {
    var tests = [
      [10000, 12.000, 360, 30, "887719069147705830000"],
      [10000, 6.000, 360, 30, "860286563187360300000"],
      [2000000, 15.000, 360, 30, "180322762358335458000000"],
      [123456, 12.345, 1800, 30, "2757196297755729374016"],
      [50000, 10.000, 500, 10, "1071423534507233600000"],
      [50000, 1.000, 3600, 30, "437723402324420700000"],
      [1, 0.002, 3600, 30, "8334162127476676"],
      [71601, 13.672, 493, 17, "2711812617616937811069"],
      [10000, 0.0000, 360, 30, "833333333333333333333"],
      [10000, 12.000, 1, 1, "10003287671232875100000"],
      [0, 12.000, 360, 30, "0"],
    ]
    mochaEach(tests).it("should calculate things correctly", async (balance, interestApr, termInDays, paymentPeriodInDays, expected) => {
      var rateDecimals = 1000; // This is just for convenience so we can denominate rates in decimals
      var rateMultiplier = decimals.div(new BN(rateDecimals)).div(new BN(100));
      balance = bigVal(balance);
      interestApr = new BN(interestApr * rateDecimals).mul(rateMultiplier);
      termInDays = new BN(termInDays);
      paymentPeriodIndays = new BN(paymentPeriodInDays);
      expected = new BN(expected);

      const result = await creditDesk._calculateAnnuityPayment(balance, interestApr, termInDays, paymentPeriodInDays);
      expect(result.eq(expected)).to.be.true;
    });

    it("should gracefully handle extremely small, but > 0 interest rates", async () => {
      const balance = bigVal(10000)
      const interestApr = new BN(1);
      const termInDays = new BN(360);
      const paymentPeriodInDays = new BN(30);
      expected = new BN("833333333333333333333");
      const result = await creditDesk._calculateAnnuityPayment(balance, interestApr, termInDays, paymentPeriodInDays);
      expect(result.eq(expected)).to.be.true;
    });

    describe("with invalid data", async () => {
      // TODO: Consider if we need this.
    });
  });

  describe("prepayment", async () => {
    let makePrepayment = async (creditLineAddress, amount, from=borrower) => {
      return await creditDesk.prepayment(creditLineAddress, {from: from, value: String(bigVal(amount))});
    }
    describe("with a valid creditline id", async () => {
      beforeEach(async () => {
        underwriter = person2;
        borrower = person3;
        underwriterLimit = bigVal(600);
        await creditDesk.setUnderwriterGovernanceLimit(underwriter, underwriterLimit, {from: owner});

        await createCreditLine();
        var ulCreditLines = await creditDesk.getUnderwriterCreditLines(underwriter);
        creditLine = await CreditLine.at(ulCreditLines[0]);
      })
      it("should increment the prepaid balance", async () => {
        const prepaymentAmount = 10;
        expect((await (await getBalance(creditLine.address)).eq(bigVal(0)))).to.be.true;
        await makePrepayment(creditLine.address, prepaymentAmount);
        expect((await getBalance(creditLine.address)).eq(bigVal(prepaymentAmount))).to.be.true;
        expect((await creditLine.prepaymentBalance()).eq(bigVal(prepaymentAmount))).to.be.true;

        let secondPrepayment = 15;
        let totalPrepayment = bigVal(prepaymentAmount).add(bigVal(secondPrepayment));
        await makePrepayment(creditLine.address, secondPrepayment);
        expect((await getBalance(creditLine.address)).eq(totalPrepayment)).to.be.true;
        expect((await creditLine.prepaymentBalance()).eq(totalPrepayment)).to.be.true;
      });
    });
  })
})
